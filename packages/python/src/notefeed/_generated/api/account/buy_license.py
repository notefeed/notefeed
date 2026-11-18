from http import HTTPStatus
from typing import Any

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.checkout import Checkout
from ...models.checkout_request import CheckoutRequest
from ...models.error import Error
from ...types import Response


def _get_kwargs(
    *,
    body: CheckoutRequest,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/account/license/checkout",
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Checkout | Error | None:
    if response.status_code == 200:
        response_200 = Checkout.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())

        return response_403

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Checkout | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    *,
    client: AuthenticatedClient,
    body: CheckoutRequest,
) -> Response[Checkout | Error]:
    """Buy a license for the account

     The payment provider's checkout for `units` feeds (1 to 100), per `period` (`month`, or `year` where
    sold). Send the buyer to `url`; once paid, a new subscription is on the account, and they come back
    to the account page. Buying more later adds a subscription; change one's units with
    `changeLicenseUnits`.

    Args:
        body (CheckoutRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Checkout | Error]
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
    body: CheckoutRequest,
) -> Checkout | Error | None:
    """Buy a license for the account

     The payment provider's checkout for `units` feeds (1 to 100), per `period` (`month`, or `year` where
    sold). Send the buyer to `url`; once paid, a new subscription is on the account, and they come back
    to the account page. Buying more later adds a subscription; change one's units with
    `changeLicenseUnits`.

    Args:
        body (CheckoutRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Checkout | Error
    """

    return sync_detailed(
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    *,
    client: AuthenticatedClient,
    body: CheckoutRequest,
) -> Response[Checkout | Error]:
    """Buy a license for the account

     The payment provider's checkout for `units` feeds (1 to 100), per `period` (`month`, or `year` where
    sold). Send the buyer to `url`; once paid, a new subscription is on the account, and they come back
    to the account page. Buying more later adds a subscription; change one's units with
    `changeLicenseUnits`.

    Args:
        body (CheckoutRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Checkout | Error]
    """

    kwargs = _get_kwargs(
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    *,
    client: AuthenticatedClient,
    body: CheckoutRequest,
) -> Checkout | Error | None:
    """Buy a license for the account

     The payment provider's checkout for `units` feeds (1 to 100), per `period` (`month`, or `year` where
    sold). Send the buyer to `url`; once paid, a new subscription is on the account, and they come back
    to the account page. Buying more later adds a subscription; change one's units with
    `changeLicenseUnits`.

    Args:
        body (CheckoutRequest):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Checkout | Error
    """

    return (
        await asyncio_detailed(
            client=client,
            body=body,
        )
    ).parsed
