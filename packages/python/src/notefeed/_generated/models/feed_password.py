from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="FeedPassword")


@_attrs_define
class FeedPassword:
    """
    Attributes:
        id (str): The password's id, to revoke it
        name (str): What it is for, as the owner named it ("blog script", "Anna"); a feed's password from before it had
            an owner is "Feed password"
        created (None | str): When it was added (ISO 8601); null for the one from before the feed had an owner
    """

    id: str
    name: str
    created: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        created: None | str
        created = self.created

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "created": created,
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

        feed_password = cls(
            id=id,
            name=name,
            created=created,
        )

        return feed_password
