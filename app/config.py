from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SECRET_KEY: str = "change-me"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 720
    DATABASE_URL: str = "sqlite:///./data/shop.db"
    APP_NAME: str = "Shop Manager"


settings = Settings()
