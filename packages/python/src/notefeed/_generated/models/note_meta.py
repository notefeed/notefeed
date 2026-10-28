from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

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
        tags (list[str] | Unset): The note's tags, the whole new list (`["ci","done"]`): at most 10 tags, each 1 to 32
            characters of letters, digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed. Empty
            removes them all; omitted leaves them as they are.
        date (str | Unset): An ISO 8601 date and time with its offset (`2026-10-01T09:30:00Z`,
            `2026-10-01T11:30:00+02:00`) or a date alone (midnight UTC). When the note is placed in the feed, from 1970 to
            9999. A time after now schedules it: readers see it from then on. The note's attachments move with it.
        draft (bool | Unset): true makes the note a draft, which readers do not see; false publishes it. Its attachments
            follow (an attachment's own state can't be set: 400), and its date stays: a past date places it there, a future
            one schedules it. A note whose picture is the feed's title image cannot become a draft (409, `title_image`)
    """

    title: str | Unset = UNSET
    alt: str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    date: str | Unset = UNSET
    draft: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        alt = self.alt

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags

        date = self.date

        draft = self.draft

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if title is not UNSET:
            field_dict["title"] = title
        if alt is not UNSET:
            field_dict["alt"] = alt
        if tags is not UNSET:
            field_dict["tags"] = tags
        if date is not UNSET:
            field_dict["date"] = date
        if draft is not UNSET:
            field_dict["draft"] = draft

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title", UNSET)

        alt = d.pop("alt", UNSET)

        tags = cast(list[str], d.pop("tags", UNSET))

        date = d.pop("date", UNSET)

        draft = d.pop("draft", UNSET)

        note_meta = cls(
            title=title,
            alt=alt,
            tags=tags,
            date=date,
            draft=draft,
        )

        return note_meta
