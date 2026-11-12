from http import HTTPStatus
from io import BytesIO
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    file: str,
    *,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/feeds/{feed}/files/{file}".format(
            feed=quote(str(feed), safe=""),
            file=quote(str(file), safe=""),
        ),
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | File | None:
    if response.status_code == 200:
        response_200 = File(payload=BytesIO(response.content))

        return response_200

    if response.status_code == 304:
        response_304 = File(payload=BytesIO(response.content))

        return response_304

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 410:
        response_410 = Error.from_dict(response.json())

        return response_410

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
) -> Response[Error | File]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    feed: str,
    file: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | File]:
    """Get one of the feed's files

     A note's file by its own name (`<id>.<ext>`, a note's `file`), for whoever may post to the feed:
    also a draft's or a scheduled note's, which the read link (`file_url`) does not serve until readers
    may see them, so a post with pictures can be checked before it goes out. The body is the file's
    bytes, with the `Content-Type` of its extension and an `ETag` (`If-None-Match` gives `304`). Files
    by any other name, as the read link has them, are not served here.

    Args:
        feed (str):
        file (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | File]
    """

    kwargs = _get_kwargs(
        feed=feed,
        file=file,
        x_feed_password=x_feed_password,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    file: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Error | File | None:
    """Get one of the feed's files

     A note's file by its own name (`<id>.<ext>`, a note's `file`), for whoever may post to the feed:
    also a draft's or a scheduled note's, which the read link (`file_url`) does not serve until readers
    may see them, so a post with pictures can be checked before it goes out. The body is the file's
    bytes, with the `Content-Type` of its extension and an `ETag` (`If-None-Match` gives `304`). Files
    by any other name, as the read link has them, are not served here.

    Args:
        feed (str):
        file (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | File
    """

    return sync_detailed(
        feed=feed,
        file=file,
        client=client,
        x_feed_password=x_feed_password,
    ).parsed


async def asyncio_detailed(
    feed: str,
    file: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | File]:
    """Get one of the feed's files

     A note's file by its own name (`<id>.<ext>`, a note's `file`), for whoever may post to the feed:
    also a draft's or a scheduled note's, which the read link (`file_url`) does not serve until readers
    may see them, so a post with pictures can be checked before it goes out. The body is the file's
    bytes, with the `Content-Type` of its extension and an `ETag` (`If-None-Match` gives `304`). Files
    by any other name, as the read link has them, are not served here.

    Args:
        feed (str):
        file (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | File]
    """

    kwargs = _get_kwargs(
        feed=feed,
        file=file,
        x_feed_password=x_feed_password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    file: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Error | File | None:
    """Get one of the feed's files

     A note's file by its own name (`<id>.<ext>`, a note's `file`), for whoever may post to the feed:
    also a draft's or a scheduled note's, which the read link (`file_url`) does not serve until readers
    may see them, so a post with pictures can be checked before it goes out. The body is the file's
    bytes, with the `Content-Type` of its extension and an `ETag` (`If-None-Match` gives `304`). Files
    by any other name, as the read link has them, are not served here.

    Args:
        feed (str):
        file (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | File
    """

    return (
        await asyncio_detailed(
            feed=feed,
            file=file,
            client=client,
            x_feed_password=x_feed_password,
        )
    ).parsed
