from enum import StrEnum


class CheckoutRequestPeriod(StrEnum):
    MONTH = "month"
    YEAR = "year"

    def __str__(self) -> str:
        return str(self.value)
