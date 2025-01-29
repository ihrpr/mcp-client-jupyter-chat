import asyncio
from mcp_server_jupyter import run


try:
    from ._version import __version__
except ImportError:
    # Fallback when using the package in dev mode without installing
    # in editable mode with pip. It is highly recommended to install
    # the package from a stable release or in editable mode: https://pip.pypa.io/en/stable/topics/local-project-installs/#editable-installs
    import warnings

    warnings.warn("Importing 'mcp_client_jupyter_chat' outside a proper installation.")
    __version__ = "dev"


def _jupyter_labextension_paths():
    return [{"src": "labextension", "dest": "mcp-client-jupyter-chat"}]


def _jupyter_server_extension_points():
    return [{"module": "mcp_client_jupyter_chat"}]


def _load_jupyter_server_extension(server_app):
    """
    Called during notebook server extension loading.
    Args:
        server_app (NotebookWebApplication): handle to the Notebook webserver instance.
    """
    name = "mcp_client_jupyter_chat"
    server_app.log.info(f"Registered {name} server extension")

    # Get the current event loop or create a new one
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    # Create and schedule the task
    loop.create_task(run(transport_type="sse", port=3002))
