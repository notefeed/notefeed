from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.checkout_request_period import CheckoutRequestPeriod
from ..types import UNSET, Unset

T = TypeVar("T", bound="CheckoutRequest")


@_attrs_define
class CheckoutRequest:
    """
    Attributes:
        period (CheckoutRequestPeriod | Unset): Default month
        units (int | Unset): How many feeds, 1 to 100; default 1
    """

    period: CheckoutRequestPeriod | Unset = UNSET
    units: int | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        period: str | Unset = UNSET
        if not isinstance(self.period, Unset):
            period = self.period.value

        units = self.units

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if period is not UNSET:
            field_dict["period"] = period
        if units is not UNSET:
            field_dict["units"] = units

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        _period = d.pop("period", UNSET)
        period: CheckoutRequestPeriod | Unset
        if isinstance(_period, Unset):
            period = UNSET
        else:
            period = CheckoutRequestPeriod(_period)

        units = d.pop("units", UNSET)

        checkout_request = cls(
            period=period,
            units=units,
        )

        return checkout_request
