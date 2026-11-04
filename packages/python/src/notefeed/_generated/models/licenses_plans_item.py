from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.licenses_plans_item_period import LicensesPlansItemPeriod

T = TypeVar("T", bound="LicensesPlansItem")


@_attrs_define
class LicensesPlansItem:
    """
    Attributes:
        period (LicensesPlansItemPeriod): How long one payment lasts; the license renews until cancelled
        name (str): The plan's name, as the payment provider holds it
        description (str): The plan's description from the payment provider, possibly empty
        amount (int): The price per period in the currency's smallest unit (cents)
        currency (str): ISO 4217 code, e.g. EUR
        tax_included (bool): Whether the amount includes VAT
    """

    period: LicensesPlansItemPeriod
    name: str
    description: str
    amount: int
    currency: str
    tax_included: bool

    def to_dict(self) -> dict[str, Any]:
        period = self.period.value

        name = self.name

        description = self.description

        amount = self.amount

        currency = self.currency

        tax_included = self.tax_included

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "period": period,
                "name": name,
                "description": description,
                "amount": amount,
                "currency": currency,
                "tax_included": tax_included,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        period = LicensesPlansItemPeriod(d.pop("period"))

        name = d.pop("name")

        description = d.pop("description")

        amount = d.pop("amount")

        currency = d.pop("currency")

        tax_included = d.pop("tax_included")

        licenses_plans_item = cls(
            period=period,
            name=name,
            description=description,
            amount=amount,
            currency=currency,
            tax_included=tax_included,
        )

        return licenses_plans_item
