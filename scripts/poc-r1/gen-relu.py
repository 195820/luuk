# R1 PoC 辅助：用 onnx 生成一个 checker 通过的最小 Relu 模型，并打印其字节 hex
# 用途：1) 直接产出可推理模型验证 onnxruntime-node 端到端 2) 参考 hex 校准 bench-poc-r1.mjs 的手写 protobuf
# 用法：python scripts/poc-r1/gen-relu.py <输出路径>
import sys, onnx
import onnx.helper as h

out = sys.argv[1] if len(sys.argv) > 1 else "relu.onnx"
node = h.make_node("Relu", ["X"], ["Y"], name="relu0")
graph = h.make_graph(
    [node], "poc-r1",
    [h.make_tensor_value_info("X", onnx.TensorProto.FLOAT, [1, 4])],
    [h.make_tensor_value_info("Y", onnx.TensorProto.FLOAT, [1, 4])],
)
model = h.make_model(graph, opset_imports=[h.make_opsetid("", 13)])
model.ir_version = 8
onnx.checker.check_model(model)
data = model.SerializeToString()
with open(out, "wb") as f:
    f.write(data)
print("IR_VERSION", model.ir_version, "OPSET", model.opset_import[0].version, "BYTES", len(data))
print("HEX", data.hex())
