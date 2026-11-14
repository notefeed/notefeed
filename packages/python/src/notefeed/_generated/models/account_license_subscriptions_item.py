from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.account_license_subscriptions_item_period import AccountLicenseSubscriptionsItemPeriod

T = TypeVar("T", bound="AccountLicenseSubscriptionsItem")


@_attrs_define
class AccountLicenseSubscriptionsItem:
    """
    Attributes:
        id (str): The provider's subscription id
        period (AccountLicenseSubscriptionsItemPeriod):
        units (int): How many feeds it covers
        valid_until (float | None): When its paid period ends (ms since the epoch), or null
        active (bool): Whether it is paid for now
    """

    id: str
    period: AccountLicenseSubscriptionsItemPeriod
    units: int
    valid_until: float | None
    active: bool

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        period = self.period.value

        units = self.units

        valid_until: float | None
        valid_until = self.valid_until

        active = self.active

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "period": period,
                "units": units,
                "valid_until": valid_until,
                "active": active,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        period = AccountLicenseSubscriptionsItemPeriod(d.pop("period"))

        units = d.pop("units")

        def _parse_valid_until(data: object) -> float | None:
            if data is None:
                return data
            return cast(float | None, data)

        valid_until = _parse_valid_until(d.pop("valid_until"))

        active = d.pop("active")

        account_license_subscriptions_item = cls(
            id=id,
            period=period,
            units=units,
            valid_until=valid_until,
            active=active,
        )

        return account_license_subscriptions_item
