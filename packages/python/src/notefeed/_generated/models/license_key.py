from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="LicenseKey")


@_attrs_define
class LicenseKey:
    """
    Attributes:
        key (str): The license key, as the checkout or the receipt gave it
    """

    key: str

    def to_dict(self) -> dict[str, Any]:
        key = self.key

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "key": key,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        key = d.pop("key")

        license_key = cls(
            key=key,
        )

        return license_key
