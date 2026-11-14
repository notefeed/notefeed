from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="NewFeedPassword")


@_attrs_define
class NewFeedPassword:
    """
    Attributes:
        id (str): The password's id, to revoke it
        name (str): What it is for, as the owner named it ("blog script", "Anna"); a feed's password from before it had
            an owner is "Feed password"
        created (None | str): When it was added (ISO 8601); null for the one from before the feed had an owner
        password (str): The password, 24 characters: shown only this once. Send it as X-Feed-Password
    """

    id: str
    name: str
    created: None | str
    password: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        created: None | str
        created = self.created

        password = self.password

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "created": created,
                "password": password,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        def _parse_created(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        created = _parse_created(d.pop("created"))

        password = d.pop("password")

        new_feed_password = cls(
            id=id,
            name=name,
            created=created,
            password=password,
        )

        return new_feed_password
