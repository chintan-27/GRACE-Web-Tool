class ModelRunner:
    def __init__(self, name):
        self.name = name

    def load(self):
        pass

    def preprocess(self, img):
        pass

    def infer(self, tensor):
        pass

    def save(self, output_path):
        pass
