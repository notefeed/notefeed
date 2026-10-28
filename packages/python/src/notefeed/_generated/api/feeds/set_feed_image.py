from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed import Feed
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/feeds/{feed}/image".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

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

    if response.status_code == 403:
        response_403 = Error.from_dict(response.json())

        return response_403

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 413:
        response_413 = Error.from_dict(response.json())

        return response_413

    if response.status_code == 415:
        response_415 = Error.from_dict(response.json())

        return response_415

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 451:
        response_451 = Error.from_dict(response.json())

        return response_451

    if response.status_code == 503:
        response_503 = Error.from_dict(response.json())

        return response_503

    if response.status_code == 507:
        response_507 = Error.from_dict(response.json())

        return response_507

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
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Set the feed's title image

     Uploads the image (its bytes, of the type `Content-Type` declares) as the feed's own title image: it
    is shown in the feed's header and stored as an image note, but in no list (timeline, RSS, the read
    API, counts), so it is no post. A previous title image uploaded this way is deleted; a posted image
    picked with `updateFeed`'s `image` stays a post. The same checks as posting a picture apply. The
    feed must exist. An image is stored processed, not as sent: turned the way its EXIF orientation
    says, scaled to at most 2560 px on its long side, encoded again in its own format (JPEG and WebP at
    quality 85, PNG lossless, an animated GIF or WebP keeps its frames), and without metadata (EXIF, GPS
    position, XMP, comments). Send it full size; one of more than 100 megapixels is `413`, and a body
    that does not decode as the image it declares is `415`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

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
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Set the feed's title image

     Uploads the image (its bytes, of the type `Content-Type` declares) as the feed's own title image: it
    is shown in the feed's header and stored as an image note, but in no list (timeline, RSS, the read
    API, counts), so it is no post. A previous title image uploaded this way is deleted; a posted image
    picked with `updateFeed`'s `image` stays a post. The same checks as posting a picture apply. The
    feed must exist. An image is stored processed, not as sent: turned the way its EXIF orientation
    says, scaled to at most 2560 px on its long side, encoded again in its own format (JPEG and WebP at
    quality 85, PNG lossless, an animated GIF or WebP keeps its frames), and without metadata (EXIF, GPS
    position, XMP, comments). Send it full size; one of more than 100 megapixels is `413`, and a body
    that does not decode as the image it declares is `415`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

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
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Set the feed's title image

     Uploads the image (its bytes, of the type `Content-Type` declares) as the feed's own title image: it
    is shown in the feed's header and stored as an image note, but in no list (timeline, RSS, the read
    API, counts), so it is no post. A previous title image uploaded this way is deleted; a posted image
    picked with `updateFeed`'s `image` stays a post. The same checks as posting a picture apply. The
    feed must exist. An image is stored processed, not as sent: turned the way its EXIF orientation
    says, scaled to at most 2560 px on its long side, encoded again in its own format (JPEG and WebP at
    quality 85, PNG lossless, an animated GIF or WebP keeps its frames), and without metadata (EXIF, GPS
    position, XMP, comments). Send it full size; one of more than 100 megapixels is `413`, and a body
    that does not decode as the image it declares is `415`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

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
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Set the feed's title image

     Uploads the image (its bytes, of the type `Content-Type` declares) as the feed's own title image: it
    is shown in the feed's header and stored as an image note, but in no list (timeline, RSS, the read
    API, counts), so it is no post. A previous title image uploaded this way is deleted; a posted image
    picked with `updateFeed`'s `image` stays a post. The same checks as posting a picture apply. The
    feed must exist. An image is stored processed, not as sent: turned the way its EXIF orientation
    says, scaled to at most 2560 px on its long side, encoded again in its own format (JPEG and WebP at
    quality 85, PNG lossless, an animated GIF or WebP keeps its frames), and without metadata (EXIF, GPS
    position, XMP, comments). Send it full size; one of more than 100 megapixels is `413`, and a body
    that does not decode as the image it declares is `415`.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

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
