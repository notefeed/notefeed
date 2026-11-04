from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.create_feed_json import CreateFeedJson
from ...models.error import Error
from ...models.feed import Feed
from ...types import Response


def _get_kwargs(
    feed: str,
    *,
    body: CreateFeedJson,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}".format(
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
    if response.status_code == 201:
        response_201 = Feed.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 402:
        response_402 = Error.from_dict(response.json())

        return response_402

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

    if response.status_code == 410:
        response_410 = Error.from_dict(response.json())

        return response_410

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

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
    body: CreateFeedJson,
) -> Response[Error | Feed]:
    """Create a feed without posting a note

     Reserves the feed name now (ADR 0047): with a password it is protected from its first moment, with a
    read id it gets that read link. Where licenses are sold a license key is required and goes on the
    new feed; free feeds start with their first note. A feed that exists is 409. Counts against the post
    rate limit and the instance's feed cap, like a first post. After it, change the title and
    description with updateFeed.

    Args:
        feed (str):
        body (CreateFeedJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
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
    body: CreateFeedJson,
) -> Error | Feed | None:
    """Create a feed without posting a note

     Reserves the feed name now (ADR 0047): with a password it is protected from its first moment, with a
    read id it gets that read link. Where licenses are sold a license key is required and goes on the
    new feed; free feeds start with their first note. A feed that exists is 409. Counts against the post
    rate limit and the instance's feed cap, like a first post. After it, change the title and
    description with updateFeed.

    Args:
        feed (str):
        body (CreateFeedJson):

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
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: CreateFeedJson,
) -> Response[Error | Feed]:
    """Create a feed without posting a note

     Reserves the feed name now (ADR 0047): with a password it is protected from its first moment, with a
    read id it gets that read link. Where licenses are sold a license key is required and goes on the
    new feed; free feeds start with their first note. A feed that exists is 409. Counts against the post
    rate limit and the instance's feed cap, like a first post. After it, change the title and
    description with updateFeed.

    Args:
        feed (str):
        body (CreateFeedJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
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
    body: CreateFeedJson,
) -> Error | Feed | None:
    """Create a feed without posting a note

     Reserves the feed name now (ADR 0047): with a password it is protected from its first moment, with a
    read id it gets that read link. Where licenses are sold a license key is required and goes on the
    new feed; free feeds start with their first note. A feed that exists is 409. Counts against the post
    rate limit and the instance's feed cap, like a first post. After it, change the title and
    description with updateFeed.

    Args:
        feed (str):
        body (CreateFeedJson):

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
        )
    ).parsed
