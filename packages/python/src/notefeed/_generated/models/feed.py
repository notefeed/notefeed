from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.free_tier import FreeTier


T = TypeVar("T", bound="Feed")


@_attrs_define
class Feed:
    """
    Attributes:
        name (str): The feed's name
        title (str): Display title, at most 100 characters, one line (control and text-direction override characters are
            refused); empty means none (the feed's name is shown)
        description (str): Description, at most 500 characters, one line (control and text-direction override characters
            are refused); may be empty
        protected (bool): Whether the feed has its own password
        read_url (None | str): The feed's read-only RSS link; null while the feed has no notes, or if the server can't
            read the feed's stored read id
        image_url (None | str): The feed's title image (absolute URL, served under the read id), or null
        show_sender (bool): Whether readers see who posted each note
        free_tier (FreeTier | None): A feed without a license on an instance that sells them: its notes against the free
            tier's cap. null when no cap applies (a licensed feed, or an instance that sells no licenses)
    """

    name: str
    title: str
    description: str
    protected: bool
    read_url: None | str
    image_url: None | str
    show_sender: bool
    free_tier: FreeTier | None

    def to_dict(self) -> dict[str, Any]:
        from ..models.free_tier import FreeTier

        name = self.name

        title = self.title

        description = self.description

        protected = self.protected

        read_url: None | str
        read_url = self.read_url

        image_url: None | str
        image_url = self.image_url

        show_sender = self.show_sender

        free_tier: dict[str, Any] | None
        if isinstance(self.free_tier, FreeTier):
            free_tier = self.free_tier.to_dict()
        else:
            free_tier = self.free_tier

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "title": title,
                "description": description,
                "protected": protected,
                "read_url": read_url,
                "image_url": image_url,
                "show_sender": show_sender,
                "free_tier": free_tier,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.free_tier import FreeTier

        d = dict(src_dict)
        name = d.pop("name")

        title = d.pop("title")

        description = d.pop("description")

        protected = d.pop("protected")

        def _parse_read_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        read_url = _parse_read_url(d.pop("read_url"))

        def _parse_image_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image_url = _parse_image_url(d.pop("image_url"))

        show_sender = d.pop("show_sender")

        def _parse_free_tier(data: object) -> FreeTier | None:
            if data is None:
                return data
            try:
                if not isinstance(data, dict):
                    raise TypeError()
                free_tier_type_0 = FreeTier.from_dict(data)

                return free_tier_type_0
            except (TypeError, ValueError, AttributeError, KeyError):
                pass
            return cast(FreeTier | None, data)

        free_tier = _parse_free_tier(d.pop("free_tier"))

        feed = cls(
            name=name,
            title=title,
            description=description,
            protected=protected,
            read_url=read_url,
            image_url=image_url,
            show_sender=show_sender,
            free_tier=free_tier,
        )

        return feed
