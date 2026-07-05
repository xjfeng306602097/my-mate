import { Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import type { SchemaField, SchemaShape, SchemaValue } from "@/lib/schema";
export type { SchemaField, SchemaShape, SchemaValue } from "@/lib/schema";
export { buildSchemaPayload, validateRequiredFields } from "@/lib/schema";

export function SchemaForm(props: {
  schema: SchemaShape;
  value: Record<string, SchemaValue>;
  onChange: (key: string, value: SchemaValue) => void;
}) {
  const properties = props.schema.properties || {};
  const required = new Set(props.schema.required || []);
  const keys = Object.keys(properties);

  return (
    <View style={styles.container}>
      {keys.map((key) => {
        const field = properties[key];
        const label = field.title || key;
        const currentValue = props.value[key];

        return (
          <View key={key} style={styles.field}>
            <Text style={styles.label}>
              {label}
              {required.has(key) ? <Text style={styles.required}> *</Text> : null}
            </Text>
            {field.description ? <Text style={styles.hint}>{field.description}</Text> : null}

            {field.enum?.length ? (
              <View style={styles.segmented}>
                {field.enum.map((option) => {
                  const selected = currentValue === option;
                  return (
                    <Pressable
                      key={option}
                      onPress={() => props.onChange(key, option)}
                      style={[styles.segment, selected && styles.segmentSelected]}
                    >
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                        {option}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : field.type === "boolean" ? (
              <View style={styles.switchRow}>
                <Text style={styles.switchText}>{currentValue === true ? "Yes" : "No"}</Text>
                <Switch
                  value={currentValue === true}
                  onValueChange={(value) => props.onChange(key, value)}
                />
              </View>
            ) : (
              <TextInput
                value={typeof currentValue === "string" ? currentValue : ""}
                onChangeText={(value) => props.onChange(key, value)}
                placeholder={placeholderFor(field)}
                keyboardType={
                  field.type === "number" || field.type === "integer" ? "numeric" : "default"
                }
                multiline={isMultiline(field)}
                style={[styles.input, isMultiline(field) && styles.multilineInput]}
                textAlignVertical={isMultiline(field) ? "top" : "center"}
              />
            )}
          </View>
        );
      })}
    </View>
  );
}

function placeholderFor(field: SchemaField): string {
  if (field.type === "number" || field.type === "integer") {
    return "Enter a number";
  }
  if (isMultiline(field)) {
    return "Enter details";
  }
  return "Enter value";
}

function isMultiline(field: SchemaField): boolean {
  return field.multiline === true || field.format === "textarea";
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  required: {
    color: "#dc2626",
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
    color: "#64748b",
  },
  input: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
  },
  multilineInput: {
    minHeight: 96,
  },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  segment: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    paddingHorizontal: 12,
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  segmentSelected: {
    borderColor: "#2563eb",
    backgroundColor: "#dbeafe",
  },
  segmentText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#475569",
  },
  segmentTextSelected: {
    color: "#1d4ed8",
  },
  switchRow: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#cbd5e1",
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  switchText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
});
