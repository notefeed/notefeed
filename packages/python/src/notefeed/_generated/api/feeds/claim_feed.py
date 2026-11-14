from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.claim import Claim
from ...models.error import Error
from ...types import Response


def _get_kwargs(
    feed: str,
    *,
    body: Claim,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/claim".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Any | Error | None:
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

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Any | Error]:
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
    body: Claim,
) -> Response[Any | Error]:
    """Claim a feed for the signed-in account

     The feed becomes the account's own (its owner): only the owner then manages its feed passwords,
    renames and deletes it. A protected feed is claimed with one of its passwords, which stays as its
    first, named `Feed password`, so scripts keep working. An open feed is claimed by giving it a
    password, as setting one protects it. A feed with an owner can't be claimed (409, code `owned`).
    Needs the account: signed in on this instance's own pages, or its token.

    Args:
        feed (str):
        body (Claim):

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
    body: Claim,
) -> Any | Error | None:
    """Claim a feed for the signed-in account

     The feed becomes the account's own (its owner): only the owner then manages its feed passwords,
    renames and deletes it. A protected feed is claimed with one of its passwords, which stays as its
    first, named `Feed password`, so scripts keep working. An open feed is claimed by giving it a
    password, as setting one protects it. A feed with an owner can't be claimed (409, code `owned`).
    Needs the account: signed in on this instance's own pages, or its token.

    Args:
        feed (str):
        body (Claim):

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
    body: Claim,
) -> Response[Any | Error]:
    """Claim a feed for the signed-in account

     The feed becomes the account's own (its owner): only the owner then manages its feed passwords,
    renames and deletes it. A protected feed is claimed with one of its passwords, which stays as its
    first, named `Feed password`, so scripts keep working. An open feed is claimed by giving it a
    password, as setting one protects it. A feed with an owner can't be claimed (409, code `owned`).
    Needs the account: signed in on this instance's own pages, or its token.

    Args:
        feed (str):
        body (Claim):

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
    body: Claim,
) -> Any | Error | None:
    """Claim a feed for the signed-in account

     The feed becomes the account's own (its owner): only the owner then manages its feed passwords,
    renames and deletes it. A protected feed is claimed with one of its passwords, which stays as its
    first, named `Feed password`, so scripts keep working. An open feed is claimed by giving it a
    password, as setting one protects it. A feed with an owner can't be claimed (409, code `owned`).
    Needs the account: signed in on this instance's own pages, or its token.

    Args:
        feed (str):
        body (Claim):

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
