from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.licenses import Licenses
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/licenses",
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | Licenses | None:
    if response.status_code == 200:
        response_200 = Licenses.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | Licenses]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Error | Licenses]:
    """What licenses are sold, where to buy them and where to manage them

     Only on an instance that sells licenses (404 elsewhere). Public, like the license page. A license
    lifts a feed's free tier; a person buys it on `buy_url` and gets a key to put on a feed. Cancelling,
    the payment method and invoices are at the payment provider, where buyers sign in with the e-mail
    address they bought with (`manage_url`); no license key opens it (ADR 0050).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Licenses]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient | Client,
) -> Error | Licenses | None:
    """What licenses are sold, where to buy them and where to manage them

     Only on an instance that sells licenses (404 elsewhere). Public, like the license page. A license
    lifts a feed's free tier; a person buys it on `buy_url` and gets a key to put on a feed. Cancelling,
    the payment method and invoices are at the payment provider, where buyers sign in with the e-mail
    address they bought with (`manage_url`); no license key opens it (ADR 0050).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Licenses
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient | Client,
) -> Response[Error | Licenses]:
    """What licenses are sold, where to buy them and where to manage them

     Only on an instance that sells licenses (404 elsewhere). Public, like the license page. A license
    lifts a feed's free tier; a person buys it on `buy_url` and gets a key to put on a feed. Cancelling,
    the payment method and invoices are at the payment provider, where buyers sign in with the e-mail
    address they bought with (`manage_url`); no license key opens it (ADR 0050).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Licenses]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient | Client,
) -> Error | Licenses | None:
    """What licenses are sold, where to buy them and where to manage them

     Only on an instance that sells licenses (404 elsewhere). Public, like the license page. A license
    lifts a feed's free tier; a person buys it on `buy_url` and gets a key to put on a feed. Cancelling,
    the payment method and invoices are at the payment provider, where buyers sign in with the e-mail
    address they bought with (`manage_url`); no license key opens it (ADR 0050).

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Licenses
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
