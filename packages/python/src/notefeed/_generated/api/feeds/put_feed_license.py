from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed import Feed
from ...models.license_key import LicenseKey
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: LicenseKey,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/feeds/{feed}/license".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | Feed | None:
    if response.status_code == 200:
        response_200 = Feed.from_dict(response.json())

        return response_200

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
) -> Response[Error | Feed]:
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
    body: LicenseKey,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Put a license on a feed

     Only on an instance that sells licenses (404 elsewhere). Puts the license the key names on the feed,
    taking it off the feed it was on; a feed that has an active license already answers 400 (take it off
    first). A feed needs no password for a license. A key notefeed doesn't know is 400 and counts as a
    failed attempt, like a wrong password. Needs the feed's password if it has one, and counts against
    the post rate limit. Only on a feed that exists: it is created by its first note, which can bring
    the key in `X-License-Key`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (LicenseKey):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: LicenseKey,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Put a license on a feed

     Only on an instance that sells licenses (404 elsewhere). Puts the license the key names on the feed,
    taking it off the feed it was on; a feed that has an active license already answers 400 (take it off
    first). A feed needs no password for a license. A key notefeed doesn't know is 400 and counts as a
    failed attempt, like a wrong password. Needs the feed's password if it has one, and counts against
    the post rate limit. Only on a feed that exists: it is created by its first note, which can bring
    the key in `X-License-Key`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (LicenseKey):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Feed
    """

    return sync_detailed(
        feed=feed,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: LicenseKey,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Put a license on a feed

     Only on an instance that sells licenses (404 elsewhere). Puts the license the key names on the feed,
    taking it off the feed it was on; a feed that has an active license already answers 400 (take it off
    first). A feed needs no password for a license. A key notefeed doesn't know is 400 and counts as a
    failed attempt, like a wrong password. Needs the feed's password if it has one, and counts against
    the post rate limit. Only on a feed that exists: it is created by its first note, which can bring
    the key in `X-License-Key`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (LicenseKey):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: LicenseKey,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Put a license on a feed

     Only on an instance that sells licenses (404 elsewhere). Puts the license the key names on the feed,
    taking it off the feed it was on; a feed that has an active license already answers 400 (take it off
    first). A feed needs no password for a license. A key notefeed doesn't know is 400 and counts as a
    failed attempt, like a wrong password. Needs the feed's password if it has one, and counts against
    the post rate limit. Only on a feed that exists: it is created by its first note, which can bring
    the key in `X-License-Key`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (LicenseKey):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Feed
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
        )
    ).parsed
