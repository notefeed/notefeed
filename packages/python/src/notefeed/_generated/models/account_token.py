from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.account_token_scope import AccountTokenScope

T = TypeVar("T", bound="AccountToken")


@_attrs_define
class AccountToken:
    """
    Attributes:
        id (str): The token's id, to revoke it
        name (str): What it is for
        scope (AccountTokenScope): `read`: only reading requests; `read+write`: everything the account may do
        expires_at (None | str): When it stops working (ISO 8601)
        last_used (None | str): When it was last used (ISO 8601), or null
    """

    id: str
    name: str
    scope: AccountTokenScope
    expires_at: None | str
    last_used: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        scope = self.scope.value

        expires_at: None | str
        expires_at = self.expires_at

        last_used: None | str
        last_used = self.last_used

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "scope": scope,
                "expires_at": expires_at,
                "last_used": last_used,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        scope = AccountTokenScope(d.pop("scope"))

        def _parse_expires_at(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        expires_at = _parse_expires_at(d.pop("expires_at"))

        def _parse_last_used(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        last_used = _parse_last_used(d.pop("last_used"))

        account_token = cls(
            id=id,
            name=name,
            scope=scope,
            expires_at=expires_at,
            last_used=last_used,
        )

        return account_token
