from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed_password_name import FeedPasswordName
from ...models.new_feed_password import NewFeedPassword
from ...types import Response


def _get_kwargs(
    feed: str,
    *,
    body: FeedPasswordName,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/passwords".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | NewFeedPassword | None:
    if response.status_code == 201:
        response_201 = NewFeedPassword.from_dict(response.json())

        return response_201

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

    if response.status_code == 503:
        response_503 = Error.from_dict(response.json())

        return response_503

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | NewFeedPassword]:
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
    body: FeedPasswordName,
) -> Response[Error | NewFeedPassword]:
    """Add a named password to an owned feed

     A new password for one person or script, generated and shown only in this answer. It does what a
    feed password does: post, edit, delete notes, change the settings. Each is revoked on its own. Only
    for the feed's owner; where licenses are sold, the feed needs one.

    Args:
        feed (str):
        body (FeedPasswordName):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NewFeedPassword]
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
    body: FeedPasswordName,
) -> Error | NewFeedPassword | None:
    """Add a named password to an owned feed

     A new password for one person or script, generated and shown only in this answer. It does what a
    feed password does: post, edit, delete notes, change the settings. Each is revoked on its own. Only
    for the feed's owner; where licenses are sold, the feed needs one.

    Args:
        feed (str):
        body (FeedPasswordName):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NewFeedPassword
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
    body: FeedPasswordName,
) -> Response[Error | NewFeedPassword]:
    """Add a named password to an owned feed

     A new password for one person or script, generated and shown only in this answer. It does what a
    feed password does: post, edit, delete notes, change the settings. Each is revoked on its own. Only
    for the feed's owner; where licenses are sold, the feed needs one.

    Args:
        feed (str):
        body (FeedPasswordName):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NewFeedPassword]
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
    body: FeedPasswordName,
) -> Error | NewFeedPassword | None:
    """Add a named password to an owned feed

     A new password for one person or script, generated and shown only in this answer. It does what a
    feed password does: post, edit, delete notes, change the settings. Each is revoked on its own. Only
    for the feed's owner; where licenses are sold, the feed needs one.

    Args:
        feed (str):
        body (FeedPasswordName):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NewFeedPassword
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
        )
    ).parsed
