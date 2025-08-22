from pydantic import BaseSettings


class Settings(BaseSettings):
    """Configuration for the AI game master."""

    openai_api_key: str | None = None
    model: str = "gpt-3.5-turbo"

    class Config:
        env_file = ".env"


settings = Settings()
