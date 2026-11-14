from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.account_token_request_scope import AccountTokenRequestScope
from ..types import UNSET, Unset

T = TypeVar("T", bound="AccountTokenRequest")


@_attrs_define
class AccountTokenRequest:
    """
    Attributes:
        name (str): What it is for: one line, 1 to 50 characters
        scope (AccountTokenRequestScope | Unset): Default `read+write`
        days (int | Unset): How long it works, 1 to 365 days; default 90
    """

    name: str
    scope: AccountTokenRequestScope | Unset = UNSET
    days: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        scope: str | Unset = UNSET
        if not isinstance(self.scope, Unset):
            scope = self.scope.value

        days = self.days

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
            }
        )
        if scope is not UNSET:
            field_dict["scope"] = scope
        if days is not UNSET:
            field_dict["days"] = days

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name")

        _scope = d.pop("scope", UNSET)
        scope: AccountTokenRequestScope | Unset
        if isinstance(_scope, Unset):
            scope = UNSET
        else:
            scope = AccountTokenRequestScope(_scope)

        days = d.pop("days", UNSET)

        account_token_request = cls(
            name=name,
            scope=scope,
            days=days,
        )

        return account_token_request
