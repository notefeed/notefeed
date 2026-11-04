from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="FreeTier")


@_attrs_define
class FreeTier:
    """
    Attributes:
        notes (int): The feed's notes now: texts, images and the operator's marks alike
        cap (int): How many notes a free feed keeps; past it, each new note drops the oldest one, of any kind
    """

    notes: int
    cap: int

    def to_dict(self) -> dict[str, Any]:
        notes = self.notes

        cap = self.cap

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "notes": notes,
                "cap": cap,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        notes = d.pop("notes")

        cap = d.pop("cap")

        free_tier = cls(
            notes=notes,
            cap=cap,
        )

        return free_tier
