from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_token import AccountToken


T = TypeVar("T", bound="AccountTokens")


@_attrs_define
class AccountTokens:
    """
    Attributes:
        tokens (list[AccountToken]):
    """

    tokens: list[AccountToken]

    def to_dict(self) -> dict[str, Any]:
        tokens = []
        for tokens_item_data in self.tokens:
            tokens_item = tokens_item_data.to_dict()
            tokens.append(tokens_item)

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "tokens": tokens,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.account_token import AccountToken

        d = dict(src_dict)
        tokens = []
        _tokens = d.pop("tokens")
        for tokens_item_data in _tokens:
            tokens_item = AccountToken.from_dict(tokens_item_data)

            tokens.append(tokens_item)

        account_tokens = cls(
            tokens=tokens,
        )

        return account_tokens
