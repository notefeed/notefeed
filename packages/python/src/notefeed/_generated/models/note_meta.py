from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="NoteMeta")


@_attrs_define
class NoteMeta:
    """
    Attributes:
        title (str | Unset): The note's title, at most 100 characters, one line (control and text-direction override
            characters are refused); empty or left out means the title is taken from the text (a markdown note) or there is
            none (an image)
        alt (str | Unset): Alternative text of an image note, at most 500 characters, one line (control and text-
            direction override characters are refused)
        date (str | Unset): An ISO 8601 date and time with its offset (`2026-10-01T09:30:00Z`,
            `2026-10-01T11:30:00+02:00`) or a date alone (midnight UTC). When the note is placed in the feed, from 1970 to
            9999. A time after now schedules it: readers see it from then on. The note's attachments move with it.
    """

    title: str | Unset = UNSET
    alt: str | Unset = UNSET
    date: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        alt = self.alt

        date = self.date

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if alt is not UNSET:
            field_dict["alt"] = alt
        if date is not UNSET:
            field_dict["date"] = date

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        alt = d.pop("alt", UNSET)

        date = d.pop("date", UNSET)

        note_meta = cls(
            title=title,
            alt=alt,
            date=date,
        )

        return note_meta
