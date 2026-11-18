from enum import StrEnum


class NewAccountTokenScope(StrEnum):
    READ = "read"
    READWRITE = "read+write"

    def __str__(self) -> str:
        return str(self.value)
