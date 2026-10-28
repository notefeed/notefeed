from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.licenses_plans_item import LicensesPlansItem


T = TypeVar("T", bound="Licenses")


@_attrs_define
class Licenses:
    """
    Attributes:
        plans (list[LicensesPlansItem]): What is sold right now, monthly then yearly; empty while the payment provider
            can't be read
        buy_url (str): The license page: a person buys there, and gets the key after paying
        manage_url (str): The payment provider's sign-in for buyers, by the e-mail address bought with: cancelling, the
            payment method, invoices, keys. No license key opens it
        manage (str): How managing a purchase works, in a sentence to show a person
    """

    plans: list[LicensesPlansItem]
    buy_url: str
    manage_url: str
    manage: str

    def to_dict(self) -> dict[str, Any]:
        plans = []
        for plans_item_data in self.plans:
            plans_item = plans_item_data.to_dict()
            plans.append(plans_item)

        buy_url = self.buy_url

        manage_url = self.manage_url

        manage = self.manage

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "plans": plans,
                "buy_url": buy_url,
                "manage_url": manage_url,
                "manage": manage,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.licenses_plans_item import LicensesPlansItem

        d = dict(src_dict)
        plans = []
        _plans = d.pop("plans")
        for plans_item_data in _plans:
            plans_item = LicensesPlansItem.from_dict(plans_item_data)

            plans.append(plans_item)

        buy_url = d.pop("buy_url")

        manage_url = d.pop("manage_url")

        manage = d.pop("manage")

        licenses = cls(
            plans=plans,
            buy_url=buy_url,
            manage_url=manage_url,
            manage=manage,
        )

        return licenses
