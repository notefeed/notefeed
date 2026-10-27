from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="CreateFeedJson")


@_attrs_define
class CreateFeedJson:
    """
    Attributes:
        password (str | Unset): A password that protects the new feed: 1 to 256 printable ASCII characters, with no
            space at the start or end. Empty or left out: an open feed
        license_key (str | Unset): Where licenses are sold, required: the key of the license to put on the new feed
        read_id (str | Unset): The read id to give the feed (3 to 64 characters of a-z, 0-9, - and _); left out: a
            random one
    """

    password: str | Unset = UNSET
    license_key: str | Unset = UNSET
    read_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        password = self.password

        license_key = self.license_key

        read_id = self.read_id

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if password is not UNSET:
            field_dict["password"] = password
        if license_key is not UNSET:
            field_dict["license_key"] = license_key
        if read_id is not UNSET:
            field_dict["read_id"] = read_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        password = d.pop("password", UNSET)

        license_key = d.pop("license_key", UNSET)

        read_id = d.pop("read_id", UNSET)

        create_feed_json = cls(
            password=password,
            license_key=license_key,
            read_id=read_id,
        )

        return create_feed_json
