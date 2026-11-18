from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Units")


@_attrs_define
class Units:
    """
    Attributes:
        units (int): The new number of feeds, 1 to 100
    """

    units: int

    def to_dict(self) -> dict[str, Any]:
        units = self.units

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "units": units,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        units = d.pop("units")

        units = cls(
            units=units,
        )

        return units
