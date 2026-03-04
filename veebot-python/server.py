"""HTTP server for health checks and API endpoints."""
import asyncio
import logging
from aiohttp import web

import config

logger = logging.getLogger(__name__)

app = web.Application()


async def health_check(request):
    """Health check endpoint."""
    return web.json_response({
        "status": "ok",
        "service": "veebot-python"
    })


async def stats_handler(request):
    """Stats endpoint."""
    import context_manager
    import database
    
    db_stats = await database.get_database_statistics() if config.ENABLE_DATABASE else {}
    
    return web.json_response({
        "total_messages": db_stats.get("total_messages", 0),
        "messages_with_embeddings": db_stats.get("messages_with_embeddings", 0),
        "unique_channels": db_stats.get("unique_channels", 0),
        "semantic_mode": config.ENABLE_SEMANTIC_SEARCH,
        "database_enabled": config.ENABLE_DATABASE
    })


def setup_routes():
    """Setup HTTP routes."""
    app.router.add_get('/', health_check)
    app.router.add_get('/health', health_check)
    app.router.add_get('/stats', stats_handler)


async def start_server(host: str = "0.0.0.0", port: int = 8080):
    """Start the HTTP server."""
    setup_routes()
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, host, port)
    await site.start()
    
    logger.info(f"HTTP server started on {host}:{port}")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    web.run_app(app, host="0.0.0.0", port=8080)
