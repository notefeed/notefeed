from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.feed_password import FeedPassword


T = TypeVar("T", bound="FeedPasswords")


@_attrs_define
class FeedPasswords:
    """
    Attributes:
        passwords (list[FeedPassword]):
    """

    passwords: list[FeedPassword]

    def to_dict(self) -> dict[str, Any]:
        passwords = []
        for passwords_item_data in self.passwords:
            passwords_item = passwords_item_data.to_dict()
            passwords.append(passwords_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "passwords": passwords,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.feed_password import FeedPassword

        d = dict(src_dict)
        passwords = []
        _passwords = d.pop("passwords")
        for passwords_item_data in _passwords:
            passwords_item = FeedPassword.from_dict(passwords_item_data)

            passwords.append(passwords_item)

        feed_passwords = cls(
            passwords=passwords,
        )

        return feed_passwords
