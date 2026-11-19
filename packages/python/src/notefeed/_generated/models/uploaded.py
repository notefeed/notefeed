from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Uploaded")


@_attrs_define
class Uploaded:
    """
    Attributes:
        size (int): The bytes received
        type_ (str): The media type the upload was made for
    """

    size: int
    type_: str

    def to_dict(self) -> dict[str, Any]:
        size = self.size

        type_ = self.type_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "size": size,
                "type": type_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        size = d.pop("size")

        type_ = d.pop("type")

        uploaded = cls(
            size=size,
            type_=type_,
        )

        return uploaded
