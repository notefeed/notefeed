from enum import StrEnum


class AccountTokenScope(StrEnum):
    READ = "read"
    READWRITE = "read+write"

    def __str__(self) -> str:
        return str(self.value)
