from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="AccountFeeds")


@_attrs_define
class AccountFeeds:
    """
    Attributes:
        feeds (list[str]): The names of the feeds the account owns, sorted
    """

    feeds: list[str]

    def to_dict(self) -> dict[str, Any]:
        feeds = self.feeds

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "feeds": feeds,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        feeds = cast(list[str], d.pop("feeds"))

        account_feeds = cls(
            feeds=feeds,
        )

        return account_feeds
