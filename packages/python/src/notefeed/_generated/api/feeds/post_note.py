from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.posted import Posted
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_read_id: str | Unset = UNSET,
    x_license_key: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_date: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    if not isinstance(x_read_id, Unset):
        headers["X-Read-Id"] = x_read_id

    if not isinstance(x_license_key, Unset):
        headers["X-License-Key"] = x_license_key

    if not isinstance(x_note_title, Unset):
        headers["X-Note-Title"] = x_note_title

    if not isinstance(x_note_tags, Unset):
        headers["X-Note-Tags"] = x_note_tags

    if not isinstance(x_note_alt, Unset):
        headers["X-Note-Alt"] = x_note_alt

    if not isinstance(x_note_name, Unset):
        headers["X-Note-Name"] = x_note_name

    if not isinstance(x_note_date, Unset):
        headers["X-Note-Date"] = x_note_date

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/notes".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | Posted | None:
    if response.status_code == 201:
        response_201 = Posted.from_dict(response.json())

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

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

    if response.status_code == 410:
        response_410 = Error.from_dict(response.json())

        return response_410

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
) -> Response[Error | Posted]:
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
    x_read_id: str | Unset = UNSET,
    x_license_key: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_date: str | Unset = UNSET,
) -> Response[Error | Posted]:
    """Post a note

     The body is the note, a file, and `Content-Type` says which kind: `text/markdown` (UTF-8, at most
    102400 bytes), or an image, `image/png`, `image/jpeg`, `image/gif` or `image/webp` (at most
    NOTEFEED_MAX_IMAGE_BYTES as sent, default 10 MiB). Nothing is guessed: any other type, or none, is
    `415`, and so is a body that is not what the type says (an image is recognized by its first bytes;
    SVG is refused). Markdown is stored byte for byte. An image is stored processed, not as sent: turned
    the way its EXIF orientation says, scaled to at most 2560 px on its long side, encoded again in its
    own format (JPEG and WebP at quality 85, PNG lossless, an animated GIF or WebP keeps its frames),
    and without metadata (EXIF, GPS position, XMP, comments). Send it full size; one of more than 100
    megapixels is `413`, and a body that does not decode as the image it declares is `415`. Creates the
    feed with its first note, optionally protected by its own password (`X-Feed-Password`; 1 to 256
    printable ASCII characters, with no space at the start or end) and with the read id in `X-Read-Id`;
    both are only used by the post that creates the feed. Where licenses are sold, the post that creates
    the feed can bring a license key in `X-License-Key`, with or without a password; a feed password
    needs one, or the post is refused with `402`. Posting to a protected feed needs its password. Also
    served at `POST /{feed}`, the short form curl one-liners use. The response names the note's `file`
    and where it is served, `file_url`, under the feed's read id (public like the read link). Metadata
    goes in headers: `X-Note-Title`, `X-Note-Tags` (at most 10 tags, each 1 to 32 characters of letters,
    digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed), `X-Note-Alt`
    (images), `X-Note-Name` (the original file name), `X-Note-Date` (where it is placed in the feed: a
    past date backdates it, a future one schedules it). A markdown note with its pictures is one
    `multipart/form-data` request: a `text` part (the markdown, a field or a file part; a file part
    keeps its line breaks, a field's are sent as CRLF), `file` parts (up to 10 pictures, each with its
    file name and image `Content-Type`) and `alt.<file name>` fields. The pictures are stored first,
    each as its own note named by its file name, then the text with its references to them
    (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded) swapped for the stored files; a
    picture it never refers to is appended as `![](file)`. Several pictures may have the same file name
    (a phone calls every photo `image.jpg`): each is stored, and they are appended, but a text that
    refers to such a name is 400. Everything is checked before the first write, and a failed write
    removes what the request stored: all or nothing. `X-Note-Alt` and `X-Note-Name` are 400. The answer
    has `attachments`, the stored pictures in the order of the `file` parts. The `text` part is
    optional: `X-Note-Title` goes on the text note, `X-Note-Tags` on every note, `X-Note-Date` on the
    text note (its pictures take the milliseconds just before it); with no `text` part only the pictures
    are stored, each with the title, and the answer's top level is the first picture. A refused
    multipart post that would have created a protected feed creates nothing.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_read_id (str | Unset):
        x_license_key (str | Unset):
        x_note_title (str | Unset):
        x_note_tags (str | Unset):
        x_note_alt (str | Unset):
        x_note_name (str | Unset):
        x_note_date (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Posted]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
        x_read_id=x_read_id,
        x_license_key=x_license_key,
        x_note_title=x_note_title,
        x_note_tags=x_note_tags,
        x_note_alt=x_note_alt,
        x_note_name=x_note_name,
        x_note_date=x_note_date,
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
    x_read_id: str | Unset = UNSET,
    x_license_key: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_date: str | Unset = UNSET,
) -> Error | Posted | None:
    """Post a note

     The body is the note, a file, and `Content-Type` says which kind: `text/markdown` (UTF-8, at most
    102400 bytes), or an image, `image/png`, `image/jpeg`, `image/gif` or `image/webp` (at most
    NOTEFEED_MAX_IMAGE_BYTES as sent, default 10 MiB). Nothing is guessed: any other type, or none, is
    `415`, and so is a body that is not what the type says (an image is recognized by its first bytes;
    SVG is refused). Markdown is stored byte for byte. An image is stored processed, not as sent: turned
    the way its EXIF orientation says, scaled to at most 2560 px on its long side, encoded again in its
    own format (JPEG and WebP at quality 85, PNG lossless, an animated GIF or WebP keeps its frames),
    and without metadata (EXIF, GPS position, XMP, comments). Send it full size; one of more than 100
    megapixels is `413`, and a body that does not decode as the image it declares is `415`. Creates the
    feed with its first note, optionally protected by its own password (`X-Feed-Password`; 1 to 256
    printable ASCII characters, with no space at the start or end) and with the read id in `X-Read-Id`;
    both are only used by the post that creates the feed. Where licenses are sold, the post that creates
    the feed can bring a license key in `X-License-Key`, with or without a password; a feed password
    needs one, or the post is refused with `402`. Posting to a protected feed needs its password. Also
    served at `POST /{feed}`, the short form curl one-liners use. The response names the note's `file`
    and where it is served, `file_url`, under the feed's read id (public like the read link). Metadata
    goes in headers: `X-Note-Title`, `X-Note-Tags` (at most 10 tags, each 1 to 32 characters of letters,
    digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed), `X-Note-Alt`
    (images), `X-Note-Name` (the original file name), `X-Note-Date` (where it is placed in the feed: a
    past date backdates it, a future one schedules it). A markdown note with its pictures is one
    `multipart/form-data` request: a `text` part (the markdown, a field or a file part; a file part
    keeps its line breaks, a field's are sent as CRLF), `file` parts (up to 10 pictures, each with its
    file name and image `Content-Type`) and `alt.<file name>` fields. The pictures are stored first,
    each as its own note named by its file name, then the text with its references to them
    (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded) swapped for the stored files; a
    picture it never refers to is appended as `![](file)`. Several pictures may have the same file name
    (a phone calls every photo `image.jpg`): each is stored, and they are appended, but a text that
    refers to such a name is 400. Everything is checked before the first write, and a failed write
    removes what the request stored: all or nothing. `X-Note-Alt` and `X-Note-Name` are 400. The answer
    has `attachments`, the stored pictures in the order of the `file` parts. The `text` part is
    optional: `X-Note-Title` goes on the text note, `X-Note-Tags` on every note, `X-Note-Date` on the
    text note (its pictures take the milliseconds just before it); with no `text` part only the pictures
    are stored, each with the title, and the answer's top level is the first picture. A refused
    multipart post that would have created a protected feed creates nothing.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_read_id (str | Unset):
        x_license_key (str | Unset):
        x_note_title (str | Unset):
        x_note_tags (str | Unset):
        x_note_alt (str | Unset):
        x_note_name (str | Unset):
        x_note_date (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Posted
    """

    return sync_detailed(
        feed=feed,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
        x_read_id=x_read_id,
        x_license_key=x_license_key,
        x_note_title=x_note_title,
        x_note_tags=x_note_tags,
        x_note_alt=x_note_alt,
        x_note_name=x_note_name,
        x_note_date=x_note_date,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_read_id: str | Unset = UNSET,
    x_license_key: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_date: str | Unset = UNSET,
) -> Response[Error | Posted]:
    """Post a note

     The body is the note, a file, and `Content-Type` says which kind: `text/markdown` (UTF-8, at most
    102400 bytes), or an image, `image/png`, `image/jpeg`, `image/gif` or `image/webp` (at most
    NOTEFEED_MAX_IMAGE_BYTES as sent, default 10 MiB). Nothing is guessed: any other type, or none, is
    `415`, and so is a body that is not what the type says (an image is recognized by its first bytes;
    SVG is refused). Markdown is stored byte for byte. An image is stored processed, not as sent: turned
    the way its EXIF orientation says, scaled to at most 2560 px on its long side, encoded again in its
    own format (JPEG and WebP at quality 85, PNG lossless, an animated GIF or WebP keeps its frames),
    and without metadata (EXIF, GPS position, XMP, comments). Send it full size; one of more than 100
    megapixels is `413`, and a body that does not decode as the image it declares is `415`. Creates the
    feed with its first note, optionally protected by its own password (`X-Feed-Password`; 1 to 256
    printable ASCII characters, with no space at the start or end) and with the read id in `X-Read-Id`;
    both are only used by the post that creates the feed. Where licenses are sold, the post that creates
    the feed can bring a license key in `X-License-Key`, with or without a password; a feed password
    needs one, or the post is refused with `402`. Posting to a protected feed needs its password. Also
    served at `POST /{feed}`, the short form curl one-liners use. The response names the note's `file`
    and where it is served, `file_url`, under the feed's read id (public like the read link). Metadata
    goes in headers: `X-Note-Title`, `X-Note-Tags` (at most 10 tags, each 1 to 32 characters of letters,
    digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed), `X-Note-Alt`
    (images), `X-Note-Name` (the original file name), `X-Note-Date` (where it is placed in the feed: a
    past date backdates it, a future one schedules it). A markdown note with its pictures is one
    `multipart/form-data` request: a `text` part (the markdown, a field or a file part; a file part
    keeps its line breaks, a field's are sent as CRLF), `file` parts (up to 10 pictures, each with its
    file name and image `Content-Type`) and `alt.<file name>` fields. The pictures are stored first,
    each as its own note named by its file name, then the text with its references to them
    (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded) swapped for the stored files; a
    picture it never refers to is appended as `![](file)`. Several pictures may have the same file name
    (a phone calls every photo `image.jpg`): each is stored, and they are appended, but a text that
    refers to such a name is 400. Everything is checked before the first write, and a failed write
    removes what the request stored: all or nothing. `X-Note-Alt` and `X-Note-Name` are 400. The answer
    has `attachments`, the stored pictures in the order of the `file` parts. The `text` part is
    optional: `X-Note-Title` goes on the text note, `X-Note-Tags` on every note, `X-Note-Date` on the
    text note (its pictures take the milliseconds just before it); with no `text` part only the pictures
    are stored, each with the title, and the answer's top level is the first picture. A refused
    multipart post that would have created a protected feed creates nothing.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_read_id (str | Unset):
        x_license_key (str | Unset):
        x_note_title (str | Unset):
        x_note_tags (str | Unset):
        x_note_alt (str | Unset):
        x_note_name (str | Unset):
        x_note_date (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Posted]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
        x_read_id=x_read_id,
        x_license_key=x_license_key,
        x_note_title=x_note_title,
        x_note_tags=x_note_tags,
        x_note_alt=x_note_alt,
        x_note_name=x_note_name,
        x_note_date=x_note_date,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_read_id: str | Unset = UNSET,
    x_license_key: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_date: str | Unset = UNSET,
) -> Error | Posted | None:
    """Post a note

     The body is the note, a file, and `Content-Type` says which kind: `text/markdown` (UTF-8, at most
    102400 bytes), or an image, `image/png`, `image/jpeg`, `image/gif` or `image/webp` (at most
    NOTEFEED_MAX_IMAGE_BYTES as sent, default 10 MiB). Nothing is guessed: any other type, or none, is
    `415`, and so is a body that is not what the type says (an image is recognized by its first bytes;
    SVG is refused). Markdown is stored byte for byte. An image is stored processed, not as sent: turned
    the way its EXIF orientation says, scaled to at most 2560 px on its long side, encoded again in its
    own format (JPEG and WebP at quality 85, PNG lossless, an animated GIF or WebP keeps its frames),
    and without metadata (EXIF, GPS position, XMP, comments). Send it full size; one of more than 100
    megapixels is `413`, and a body that does not decode as the image it declares is `415`. Creates the
    feed with its first note, optionally protected by its own password (`X-Feed-Password`; 1 to 256
    printable ASCII characters, with no space at the start or end) and with the read id in `X-Read-Id`;
    both are only used by the post that creates the feed. Where licenses are sold, the post that creates
    the feed can bring a license key in `X-License-Key`, with or without a password; a feed password
    needs one, or the post is refused with `402`. Posting to a protected feed needs its password. Also
    served at `POST /{feed}`, the short form curl one-liners use. The response names the note's `file`
    and where it is served, `file_url`, under the feed's read id (public like the read link). Metadata
    goes in headers: `X-Note-Title`, `X-Note-Tags` (at most 10 tags, each 1 to 32 characters of letters,
    digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed), `X-Note-Alt`
    (images), `X-Note-Name` (the original file name), `X-Note-Date` (where it is placed in the feed: a
    past date backdates it, a future one schedules it). A markdown note with its pictures is one
    `multipart/form-data` request: a `text` part (the markdown, a field or a file part; a file part
    keeps its line breaks, a field's are sent as CRLF), `file` parts (up to 10 pictures, each with its
    file name and image `Content-Type`) and `alt.<file name>` fields. The pictures are stored first,
    each as its own note named by its file name, then the text with its references to them
    (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded) swapped for the stored files; a
    picture it never refers to is appended as `![](file)`. Several pictures may have the same file name
    (a phone calls every photo `image.jpg`): each is stored, and they are appended, but a text that
    refers to such a name is 400. Everything is checked before the first write, and a failed write
    removes what the request stored: all or nothing. `X-Note-Alt` and `X-Note-Name` are 400. The answer
    has `attachments`, the stored pictures in the order of the `file` parts. The `text` part is
    optional: `X-Note-Title` goes on the text note, `X-Note-Tags` on every note, `X-Note-Date` on the
    text note (its pictures take the milliseconds just before it); with no `text` part only the pictures
    are stored, each with the title, and the answer's top level is the first picture. A refused
    multipart post that would have created a protected feed creates nothing.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_read_id (str | Unset):
        x_license_key (str | Unset):
        x_note_title (str | Unset):
        x_note_tags (str | Unset):
        x_note_alt (str | Unset):
        x_note_name (str | Unset):
        x_note_date (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Posted
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
            x_read_id=x_read_id,
            x_license_key=x_license_key,
            x_note_title=x_note_title,
            x_note_tags=x_note_tags,
            x_note_alt=x_note_alt,
            x_note_name=x_note_name,
            x_note_date=x_note_date,
        )
    ).parsed
