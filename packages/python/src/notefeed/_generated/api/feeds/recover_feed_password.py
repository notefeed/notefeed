from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.recovery_json import RecoveryJson
from ...types import Response


def _get_kwargs(
    feed: str,
    *,
    body: RecoveryJson,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/password/recover".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | Error | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 402:
        response_402 = Error.from_dict(response.json())

        return response_402

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 503:
        response_503 = Error.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: RecoveryJson,
) -> Response[Any | Error]:
    """Recover a feed's password with its license key

     Only on an instance that sells licenses (404 elsewhere). For a lost password: the key of the license
    on this feed proves ownership instead of the current password (ADR 0037). With a new password the
    feed gets it (needs an active license, like any password change); with none, or an empty one, the
    password is removed, which a lapsed license's key may do too. A key that is not this feed's license
    is 401 and counts as a failed attempt, like a wrong password; a bad new password is refused before
    the key is tried.

    Args:
        feed (str):
        body (RecoveryJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Error]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: RecoveryJson,
) -> Any | Error | None:
    """Recover a feed's password with its license key

     Only on an instance that sells licenses (404 elsewhere). For a lost password: the key of the license
    on this feed proves ownership instead of the current password (ADR 0037). With a new password the
    feed gets it (needs an active license, like any password change); with none, or an empty one, the
    password is removed, which a lapsed license's key may do too. A key that is not this feed's license
    is 401 and counts as a failed attempt, like a wrong password; a bad new password is refused before
    the key is tried.

    Args:
        feed (str):
        body (RecoveryJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Error
    """

    return sync_detailed(
        feed=feed,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: RecoveryJson,
) -> Response[Any | Error]:
    """Recover a feed's password with its license key

     Only on an instance that sells licenses (404 elsewhere). For a lost password: the key of the license
    on this feed proves ownership instead of the current password (ADR 0037). With a new password the
    feed gets it (needs an active license, like any password change); with none, or an empty one, the
    password is removed, which a lapsed license's key may do too. A key that is not this feed's license
    is 401 and counts as a failed attempt, like a wrong password; a bad new password is refused before
    the key is tried.

    Args:
        feed (str):
        body (RecoveryJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Error]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: RecoveryJson,
) -> Any | Error | None:
    """Recover a feed's password with its license key

     Only on an instance that sells licenses (404 elsewhere). For a lost password: the key of the license
    on this feed proves ownership instead of the current password (ADR 0037). With a new password the
    feed gets it (needs an active license, like any password change); with none, or an empty one, the
    password is removed, which a lapsed license's key may do too. A key that is not this feed's license
    is 401 and counts as a failed attempt, like a wrong password; a bad new password is refused before
    the key is tried.

    Args:
        feed (str):
        body (RecoveryJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Error
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
        )
    ).parsed
