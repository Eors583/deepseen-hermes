from types import SimpleNamespace

from agent.agent_runtime_helpers import repair_tool_call


DEEPSEEN_VALID_TOOL_NAMES = {
    "deepseen_smart_video_recreations_create_and_wait",
    "deepseen_smart_image_recreations_create_and_wait",
    "deepseen_image_recreations_create_and_wait",
    "deepseen_video_recreations_create_and_wait",
}


def test_repair_tool_call_maps_known_deepseen_aliases_to_registered_tools():
    agent = SimpleNamespace(valid_tool_names=DEEPSEEN_VALID_TOOL_NAMES)

    assert (
        repair_tool_call(agent, "deepseen_image_create_and_wait")
        == "deepseen_smart_image_recreations_create_and_wait"
    )
    assert (
        repair_tool_call(agent, "deepseen_video_recreation_create_and_wait")
        == "deepseen_video_recreations_create_and_wait"
    )


def test_repair_tool_call_rejects_unknown_deepseen_tool_names():
    agent = SimpleNamespace(valid_tool_names=DEEPSEEN_VALID_TOOL_NAMES)

    assert repair_tool_call(agent, "deepseen_magic_create_and_wait") is None
    assert repair_tool_call(agent, "deepseen_image_super_fast_create_and_wait") is None
