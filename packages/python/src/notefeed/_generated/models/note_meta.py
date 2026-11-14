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
        title (str | Unset): The note's title: at most 100 characters, one line (control and text-direction override
            characters are refused). Empty removes it: a markdown note's title follows its text again.
        alt (str | Unset): A picture's alternative text: at most 500 characters, one line (control and text-direction
            override characters are refused). For image notes only. Empty removes it.
        sender (str | Unset): Who posted the note, as shown on it: at most 100 characters, one line (control and text-
            direction override characters are refused). Not verified. Empty removes it.
        tags (list[str] | Unset): The note's tags (`ci`, `deploy`): at most 10 tags, each 1 to 32 characters of letters,
            digits, `-`, `_`, `.` and `:`; case is folded to lowercase, duplicates are removed. Not verified; readers see
            them. The whole new list; empty removes them, left out keeps them.
        date (str | Unset): The note's date: an ISO 8601 date and time with its offset (`2026-10-01T09:30:00Z`) or a
            date alone (midnight UTC), from 1970 to 9999. The note takes its place in the feed by it; a time after now
            schedules it: readers see it from then on. Its attachments move with it.
        draft (bool | Unset): A draft: only whoever can post to the feed sees it, readers do not until it is published.
            Its pictures follow it. false publishes it, true hides it from readers again (refused while a picture of it is
            the feed's title image); its date stays.
    """

    title: str | Unset = UNSET
    alt: str | Unset = UNSET
    sender: str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    date: str | Unset = UNSET
    draft: bool | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        alt = self.alt

        sender = self.sender

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
        if sender is not UNSET:
            field_dict["sender"] = sender
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

        sender = d.pop("sender", UNSET)

        tags = cast(list[str], d.pop("tags", UNSET))

        date = d.pop("date", UNSET)

        draft = d.pop("draft", UNSET)

        note_meta = cls(
            title=title,
            alt=alt,
            sender=sender,
            tags=tags,
            date=date,
            draft=draft,
        )

        return note_meta
