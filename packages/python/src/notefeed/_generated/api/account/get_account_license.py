from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.account_license import AccountLicense
from ...models.error import Error
from ...types import Response


def _get_kwargs() -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/account/license",
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> AccountLicense | Error | None:
    if response.status_code == 200:
        response_200 = AccountLicense.from_dict(response.json())

        return response_200

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 503:
        response_503 = Error.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[AccountLicense | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[AccountLicense | Error]:
    """The account's license

     Its subscriptions (each with its units, period and end), how many feeds they cover together now
    (`units`), the feeds put under it in that order (`covered`) and those it covers (`licensed`: the
    first `units` of them). Only where licenses are sold.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AccountLicense | Error]
    """

    kwargs = _get_kwargs()

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    *,
    client: AuthenticatedClient,
) -> AccountLicense | Error | None:
    """The account's license

     Its subscriptions (each with its units, period and end), how many feeds they cover together now
    (`units`), the feeds put under it in that order (`covered`) and those it covers (`licensed`: the
    first `units` of them). Only where licenses are sold.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AccountLicense | Error
    """

    return sync_detailed(
        client=client,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
) -> Response[AccountLicense | Error]:
    """The account's license

     Its subscriptions (each with its units, period and end), how many feeds they cover together now
    (`units`), the feeds put under it in that order (`covered`) and those it covers (`licensed`: the
    first `units` of them). Only where licenses are sold.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[AccountLicense | Error]
    """

    kwargs = _get_kwargs()

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
) -> AccountLicense | Error | None:
    """The account's license

     Its subscriptions (each with its units, period and end), how many feeds they cover together now
    (`units`), the feeds put under it in that order (`covered`) and those it covers (`licensed`: the
    first `units` of them). Only where licenses are sold.

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        AccountLicense | Error
    """

    return (
        await asyncio_detailed(
            client=client,
        )
    ).parsed
