from enum import StrEnum


class AccountTokenRequestScope(StrEnum):
    READ = "read"
    READWRITE = "read+write"

    def __str__(self) -> str:
        return str(self.value)
