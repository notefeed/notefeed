from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.account_token_request import AccountTokenRequest
from ...models.error import Error
from ...models.new_account_token import NewAccountToken
from ...types import Response


def _get_kwargs(
    *,
    body: AccountTokenRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/account/tokens",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | NewAccountToken | None:
    if response.status_code == 201:
        response_201 = NewAccountToken.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())

        return response_403

    if response.status_code == 503:
        response_503 = Error.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | NewAccountToken]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: AccountTokenRequest,
) -> Response[Error | NewAccountToken]:
    """Make an account token

     A token for a script that acts as the whole account over this REST API (never MCP, never a browser):
    list and create its feeds, post to and manage the ones it owns. Shown only in this answer; stored
    hashed. `read` tokens may only read. Needs the account signed in on this instance's own pages, or
    MCP's `create_account_token`.

    Args:
        body (AccountTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NewAccountToken]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
    body: AccountTokenRequest,
) -> Error | NewAccountToken | None:
    """Make an account token

     A token for a script that acts as the whole account over this REST API (never MCP, never a browser):
    list and create its feeds, post to and manage the ones it owns. Shown only in this answer; stored
    hashed. `read` tokens may only read. Needs the account signed in on this instance's own pages, or
    MCP's `create_account_token`.

    Args:
        body (AccountTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NewAccountToken
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: AccountTokenRequest,
) -> Response[Error | NewAccountToken]:
    """Make an account token

     A token for a script that acts as the whole account over this REST API (never MCP, never a browser):
    list and create its feeds, post to and manage the ones it owns. Shown only in this answer; stored
    hashed. `read` tokens may only read. Needs the account signed in on this instance's own pages, or
    MCP's `create_account_token`.

    Args:
        body (AccountTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NewAccountToken]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: AccountTokenRequest,
) -> Error | NewAccountToken | None:
    """Make an account token

     A token for a script that acts as the whole account over this REST API (never MCP, never a browser):
    list and create its feeds, post to and manage the ones it owns. Shown only in this answer; stored
    hashed. `read` tokens may only read. Needs the account signed in on this instance's own pages, or
    MCP's `create_account_token`.

    Args:
        body (AccountTokenRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NewAccountToken
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
