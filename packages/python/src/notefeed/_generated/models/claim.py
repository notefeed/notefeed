from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Claim")


@_attrs_define
class Claim:
    """
    Attributes:
        password (str): A protected feed: one of its passwords. An open feed: the password it gets now, as setting one
            does (8 to 1024 characters)
    """

    password: str

    def to_dict(self) -> dict[str, Any]:
        password = self.password

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "password": password,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        password = d.pop("password")

        claim = cls(
            password=password,
        )

        return claim
