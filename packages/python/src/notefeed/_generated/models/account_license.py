from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.account_license_subscriptions_item import AccountLicenseSubscriptionsItem


T = TypeVar("T", bound="AccountLicense")


@_attrs_define
class AccountLicense:
    """
    Attributes:
        subscriptions (list[AccountLicenseSubscriptionsItem]):
        units (int): How many feeds the active subscriptions cover together
        covered (list[str]): The account's feeds put under the license, oldest first
        licensed (list[str]): Those it covers now: the first `units` of `covered`
    """

    subscriptions: list[AccountLicenseSubscriptionsItem]
    units: int
    covered: list[str]
    licensed: list[str]

    def to_dict(self) -> dict[str, Any]:
        subscriptions = []
        for subscriptions_item_data in self.subscriptions:
            subscriptions_item = subscriptions_item_data.to_dict()
            subscriptions.append(subscriptions_item)

        units = self.units

        covered = self.covered

        licensed = self.licensed

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "subscriptions": subscriptions,
                "units": units,
                "covered": covered,
                "licensed": licensed,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.account_license_subscriptions_item import AccountLicenseSubscriptionsItem

        d = dict(src_dict)
        subscriptions = []
        _subscriptions = d.pop("subscriptions")
        for subscriptions_item_data in _subscriptions:
            subscriptions_item = AccountLicenseSubscriptionsItem.from_dict(subscriptions_item_data)

            subscriptions.append(subscriptions_item)

        units = d.pop("units")

        covered = cast(list[str], d.pop("covered"))

        licensed = cast(list[str], d.pop("licensed"))

        account_license = cls(
            subscriptions=subscriptions,
            units=units,
            covered=covered,
            licensed=licensed,
        )

        return account_license
