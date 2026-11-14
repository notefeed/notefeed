from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed_passwords import FeedPasswords
from ...types import Response


def _get_kwargs(
    feed: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/feeds/{feed}/passwords".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | FeedPasswords | None:
    if response.status_code == 200:
        response_200 = FeedPasswords.from_dict(response.json())

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


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | FeedPasswords]:
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
) -> Response[Error | FeedPasswords]:
    """List an owned feed's passwords

     Their names, ids and when they were added, never the passwords. Only for the feed's owner.

    Args:
        feed (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | FeedPasswords]
    """

    kwargs = _get_kwargs(
        feed=feed,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    *,
    client: AuthenticatedClient,
) -> Error | FeedPasswords | None:
    """List an owned feed's passwords

     Their names, ids and when they were added, never the passwords. Only for the feed's owner.

    Args:
        feed (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | FeedPasswords
    """

    return sync_detailed(
        feed=feed,
        client=client,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
) -> Response[Error | FeedPasswords]:
    """List an owned feed's passwords

     Their names, ids and when they were added, never the passwords. Only for the feed's owner.

    Args:
        feed (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | FeedPasswords]
    """

    kwargs = _get_kwargs(
        feed=feed,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
) -> Error | FeedPasswords | None:
    """List an owned feed's passwords

     Their names, ids and when they were added, never the passwords. Only for the feed's owner.

    Args:
        feed (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | FeedPasswords
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
        )
    ).parsed
