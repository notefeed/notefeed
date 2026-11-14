from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.new_account_token_scope import NewAccountTokenScope

T = TypeVar("T", bound="NewAccountToken")


@_attrs_define
class NewAccountToken:
    """
    Attributes:
        id (str): The token's id, to revoke it
        name (str): What it is for
        scope (NewAccountTokenScope): `read`: only reading requests; `read+write`: everything the account may do
        expires_at (None | str): When it stops working (ISO 8601)
        last_used (None | str): When it was last used (ISO 8601), or null
        token (str): The token, shown only this once: send it as `Authorization: Bearer <token>` to the REST API
    """

    id: str
    name: str
    scope: NewAccountTokenScope
    expires_at: None | str
    last_used: None | str
    token: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        name = self.name

        scope = self.scope.value

        expires_at: None | str
        expires_at = self.expires_at

        last_used: None | str
        last_used = self.last_used

        token = self.token

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "name": name,
                "scope": scope,
                "expires_at": expires_at,
                "last_used": last_used,
                "token": token,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        name = d.pop("name")

        scope = NewAccountTokenScope(d.pop("scope"))

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

        token = d.pop("token")

        new_account_token = cls(
            id=id,
            name=name,
            scope=scope,
            expires_at=expires_at,
            last_used=last_used,
            token=token,
        )

        return new_account_token
