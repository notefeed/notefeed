from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="RecoveryJson")


@_attrs_define
class RecoveryJson:
    """
    Attributes:
        key (str): The license key on this feed, as the checkout or the receipt gave it
        password (str | Unset): The new password: 1 to 256 printable ASCII characters, with no space at the start or
            end. Empty or left out removes the password
    """

    key: str
    password: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        password = self.password

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
            }
        )
        if password is not UNSET:
            field_dict["password"] = password

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        key = d.pop("key")

        password = d.pop("password", UNSET)

        recovery_json = cls(
            key=key,
            password=password,
        )

        return recovery_json
