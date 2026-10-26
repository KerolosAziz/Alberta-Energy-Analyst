"""A small model router: one interface for providers, retries, timeouts, fallback.

    from router import GeminiProvider, Router

    newest, older = GeminiProvider(key, "gemini-3.8-flash"), GeminiProvider(key, "gemini-3.5-flash")
    router = Router([newest, older], retries=2, timeout=15, backoff_seconds=3)
    result = router.complete("Write one SQL query that ...", within=10)
    result.text, result.provider

Each provider is tried in order. A provider that errors is retried with a short backoff; one
that reports a quota, a rate limit, a bad key, a bad request or a reply it did not finish is
skipped straight away. When every provider fails, or ``within`` seconds have passed,
``AllProvidersFailed`` carries every error, and the caller decides what to serve instead.
``attempts()`` does the same but also yields a ``Retry`` each time a call fails and another
starts, so a page can say what is going on.
"""

from __future__ import annotations

import logging
import math
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Protocol

import httpx

log = logging.getLogger(__name__)

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


class ProviderError(Exception):
    """The call failed in a way that may succeed on retry (network, 5xx, bad response)."""


class Unretryable(ProviderError):
    """Quota, rate limit, bad key, bad request, or a reply the model will not finish (cut off,
    blocked): no retry, straight on to the next provider."""


class AllProvidersFailed(Exception):
    """Every provider failed. ``errors`` maps provider name to its last error text."""

    def __init__(self, errors: dict[str, str]) -> None:
        super().__init__("; ".join(f"{name}: {err}" for name, err in errors.items()))
        self.errors = errors


class Provider(Protocol):
    name: str

    def complete(self, prompt: str, *, timeout: float) -> str:
        """Return the model's text for ``prompt`` or raise ProviderError."""
        ...


@dataclass(frozen=True)
class Completion:
    text: str
    provider: str


@dataclass(frozen=True)
class Retry:
    """A call to ``failed`` did not work; ``next`` is tried now (the same provider on a retry)."""

    failed: str
    error: str
    next: str


class GeminiProvider:
    """Google Gemini through its REST API: one POST per call, the key in a header, no SDK.

    A reply is JSON. On success it holds ``candidates[0]``: its ``finishReason`` says whether
    the model finished ("STOP") or stopped early ("MAX_TOKENS", "SAFETY", ...), and its
    ``content.parts`` carry the text, sometimes split over several parts, with any reasoning
    flagged ``thought``. A blocked prompt has no candidates, only ``promptFeedback``. An error
    is ``{"error": {"code", "message", "status"}}`` under the matching HTTP status.
    """

    def __init__(self, api_key: str, model: str) -> None:
        self.name = f"gemini:{model}"
        self._headers = {"x-goog-api-key": api_key}
        self._url = GEMINI_URL.format(model=model)

    def complete(self, prompt: str, *, timeout: float) -> str:
        body = {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"temperature": 0}}
        try:
            response = httpx.post(self._url, headers=self._headers, json=body, timeout=timeout)
        except httpx.HTTPError as exc:
            raise ProviderError(f"{type(exc).__name__}: {exc}") from None
        try:
            data = response.json()
        except ValueError:
            raise ProviderError(
                f"HTTP {response.status_code}, not JSON: {response.text[:200]}"
            ) from None
        if response.status_code != 200:
            # 4xx is a bad key, a bad request, an unknown model or a used-up quota: the same
            # call would fail the same way, so no retry. 5xx is the service, so try again.
            error = Unretryable if response.status_code < 500 else ProviderError
            raise error(f"HTTP {response.status_code}: {_error_message(data)}")
        return _answer(data)


def _error_message(data: object) -> str:
    try:
        return str(data["error"]["message"])[:200]
    except (KeyError, TypeError):
        return str(data)[:200]


def _answer(data: dict) -> str:
    """The model's text out of a 200 reply, or an error when there is no finished answer."""
    candidates = data.get("candidates") or []
    if not candidates:
        reason = (data.get("promptFeedback") or {}).get("blockReason", "no candidates")
        raise Unretryable(f"prompt blocked: {reason}")
    candidate = candidates[0]
    finish = candidate.get("finishReason", "STOP")
    if finish != "STOP":
        raise Unretryable(f"stopped early: {finish}")
    parts = (candidate.get("content") or {}).get("parts") or []
    text = "".join(part.get("text", "") for part in parts if not part.get("thought"))
    if not text.strip():
        raise ProviderError("empty reply")
    return text


class Router:
    def __init__(
        self, providers: Sequence[Provider], *, retries: int, timeout: float, backoff_seconds: float
    ) -> None:
        if not providers:
            raise ValueError("at least one provider is required")
        self._providers = list(providers)
        self._retries = retries
        self._timeout = timeout
        self._backoff = backoff_seconds

    def complete(self, prompt: str, *, within: float | None = None) -> Completion:
        """Answer ``prompt`` with the first provider that succeeds, or raise AllProvidersFailed."""
        *_, completion = self.attempts(prompt, within=within)  # ends with the Completion or raises
        return completion

    def attempts(self, prompt: str, *, within: float | None = None) -> Iterator[Retry | Completion]:
        """Yield a Retry each time a call fails and another starts, then the Completion."""
        deadline = time.monotonic() + within if within else math.inf
        errors: dict[str, str] = {}
        for i, provider in enumerate(self._providers):
            following = self._providers[i + 1].name if i + 1 < len(self._providers) else None
            for attempt in range(1, self._retries + 1):
                left = deadline - time.monotonic()
                if left <= 0:
                    errors[provider.name] = f"out of time after {within:.0f}s"
                    raise AllProvidersFailed(errors)
                try:
                    text = provider.complete(prompt, timeout=min(self._timeout, left))
                except ProviderError as exc:
                    errors[provider.name] = str(exc)
                    again = attempt < self._retries and not isinstance(exc, Unretryable)
                    if not again and not following:
                        break
                    log.warning(
                        "%s failed (%s); trying %s",
                        provider.name,
                        exc,
                        "again" if again else following,
                    )
                    yield Retry(
                        failed=provider.name,
                        error=str(exc),
                        next=provider.name if again else following,
                    )
                    if not again:
                        break
                    time.sleep(min(self._backoff * attempt, max(deadline - time.monotonic(), 0)))
                else:
                    yield Completion(text=text, provider=provider.name)
                    return
        raise AllProvidersFailed(errors)
