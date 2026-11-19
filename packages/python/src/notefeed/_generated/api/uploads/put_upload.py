from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.uploaded import Uploaded
from ...types import File, Response


def _get_kwargs(
    token: str,
    *,
    body: File,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/uploads/{token}".format(
            token=quote(str(token), safe=""),
        ),
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Error | Uploaded | None:
    if response.status_code == 200:
        response_200 = Uploaded.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

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

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(*, client: AuthenticatedClient | Client, response: httpx.Response) -> Response[Error | Uploaded]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    token: str,
    *,
    client: AuthenticatedClient | Client,
    body: File,
) -> Response[Error | Uploaded]:
    """Send the file of an upload

     The URL of an upload that the MCP tool `create_upload` made (#381): its body is the file's raw bytes
    (`curl -T file <url>`), of the type the upload was made for; `Content-Type` is not read. The token
    in the path is the only credential: no instance password, feed password or account. The URL takes
    one file, within 15 minutes of being made; a refused file may be sent again. The file is then posted
    by the upload's id, over MCP (`post_file`, `post_note`'s attachments, `set_feed_image`), which runs
    every check of a post and deletes the upload. Over REST, a post takes the file in its own body, so
    there is no upload to make.

    Args:
        token (str):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Uploaded]
    """

    kwargs = _get_kwargs(
        token=token,
        body=body,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    token: str,
    *,
    client: AuthenticatedClient | Client,
    body: File,
) -> Error | Uploaded | None:
    """Send the file of an upload

     The URL of an upload that the MCP tool `create_upload` made (#381): its body is the file's raw bytes
    (`curl -T file <url>`), of the type the upload was made for; `Content-Type` is not read. The token
    in the path is the only credential: no instance password, feed password or account. The URL takes
    one file, within 15 minutes of being made; a refused file may be sent again. The file is then posted
    by the upload's id, over MCP (`post_file`, `post_note`'s attachments, `set_feed_image`), which runs
    every check of a post and deletes the upload. Over REST, a post takes the file in its own body, so
    there is no upload to make.

    Args:
        token (str):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Uploaded
    """

    return sync_detailed(
        token=token,
        client=client,
        body=body,
    ).parsed


async def asyncio_detailed(
    token: str,
    *,
    client: AuthenticatedClient | Client,
    body: File,
) -> Response[Error | Uploaded]:
    """Send the file of an upload

     The URL of an upload that the MCP tool `create_upload` made (#381): its body is the file's raw bytes
    (`curl -T file <url>`), of the type the upload was made for; `Content-Type` is not read. The token
    in the path is the only credential: no instance password, feed password or account. The URL takes
    one file, within 15 minutes of being made; a refused file may be sent again. The file is then posted
    by the upload's id, over MCP (`post_file`, `post_note`'s attachments, `set_feed_image`), which runs
    every check of a post and deletes the upload. Over REST, a post takes the file in its own body, so
    there is no upload to make.

    Args:
        token (str):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Uploaded]
    """

    kwargs = _get_kwargs(
        token=token,
        body=body,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    token: str,
    *,
    client: AuthenticatedClient | Client,
    body: File,
) -> Error | Uploaded | None:
    """Send the file of an upload

     The URL of an upload that the MCP tool `create_upload` made (#381): its body is the file's raw bytes
    (`curl -T file <url>`), of the type the upload was made for; `Content-Type` is not read. The token
    in the path is the only credential: no instance password, feed password or account. The URL takes
    one file, within 15 minutes of being made; a refused file may be sent again. The file is then posted
    by the upload's id, over MCP (`post_file`, `post_note`'s attachments, `set_feed_image`), which runs
    every check of a post and deletes the upload. Over REST, a post takes the file in its own body, so
    there is no upload to make.

    Args:
        token (str):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Uploaded
    """

    return (
        await asyncio_detailed(
            token=token,
            client=client,
            body=body,
        )
    ).parsed
